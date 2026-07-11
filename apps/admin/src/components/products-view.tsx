'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { Badge } from '@lumin/ui';
import {
  countByTab,
  filterProducts,
  PRODUCT_STATUS_TONE,
  PRODUCT_TABS,
  type ProductCardRow,
  type ProductTab,
} from '@/lib/products';

/**
 * Interactive product grid (P3-k). The RSC fetches the whole catalog once and passes it here; tab
 * (status) + search filtering are client-side — the endpoint is unpaginated by design (a made-to-order
 * catalog is small), so no re-fetch on tab/search. Each card links to the editor (/san-pham/{id}, the
 * P3-l seam); the search matches name or slug so an accent-free term still hits. Empty states are
 * split (conventions §State): a truly empty catalog gets the "add your first product" CTA, a
 * filter/search miss gets a softer "no match" with a reset.
 */
export function ProductsView({ rows }: { rows: ProductCardRow[] }) {
  const t = useTranslations('products');
  const [tab, setTab] = useState<ProductTab>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => countByTab(rows), [rows]);
  const filtered = useMemo(() => filterProducts(rows, tab, query), [rows, tab, query]);

  // Nothing in the catalog at all → the full empty state (with its own CTA); tabs/search would filter
  // an empty set, so we don't render them.
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-border-strong bg-surface-card px-6 py-16 text-center">
        <p className="max-w-sm text-text-muted">{t('empty')}</p>
        <Link
          href="/san-pham/moi"
          className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          {t('emptyCta')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label={t('tabsLabel')} className="flex flex-wrap gap-2">
          {PRODUCT_TABS.map((key) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setTab(key)}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 ${
                  active
                    ? 'border-border-strong bg-surface-sunken text-text-strong'
                    : 'border-border-subtle text-text-muted hover:border-border-strong hover:text-text-strong'
                }`}
              >
                {key === 'all' ? t('tabAll') : t(`status.${key}`)}
                <span className="tabular-nums text-text-muted">{counts[key]}</span>
              </button>
            );
          })}
        </div>

        <label className="ml-auto flex min-w-[12rem] flex-1 items-center sm:flex-none">
          <span className="sr-only">{t('searchLabel')}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="min-h-[44px] w-full rounded-lg border-2 border-border-strong bg-surface-card px-3 py-2 text-sm text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border-subtle bg-surface-card px-6 py-12 text-center">
          <p className="max-w-sm text-text-muted">{t('noMatch')}</p>
          <button
            type="button"
            onClick={() => {
              setTab('all');
              setQuery('');
            }}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-border-strong px-4 py-2 text-sm font-semibold text-text-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          >
            {t('clearFilters')}
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((row) => (
            <li key={row.id}>
              <ProductGridCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One product tile: cover (or dotgrid placeholder) with the status badge over it, name, base price.
 *  The whole card is the link to the editor — one navigable element, no nested interactive controls. */
function ProductGridCard({ row }: { row: ProductCardRow }) {
  const tStatus = useTranslations('products.status');

  return (
    <Link
      href={`/san-pham/${row.id}`}
      className="group flex h-full flex-col gap-2 rounded-xl border-2 border-border-strong bg-surface-card p-3 shadow-pop transition-transform duration-150 ease-out hover:-translate-x-px hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 motion-reduce:transform-none"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-sunken">
        {row.coverImage ? (
          <img src={row.coverImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="lumin-dotgrid h-full w-full" aria-hidden="true" />
        )}
        <div className="absolute left-2 top-2">
          <Badge tone={PRODUCT_STATUS_TONE[row.status]}>{tStatus(row.status)}</Badge>
        </div>
      </div>
      <h3 className="line-clamp-2 font-semibold leading-tight text-text-strong">{row.name}</h3>
      <p className="mt-auto font-semibold text-primary">{formatVnd(row.basePrice)}</p>
    </Link>
  );
}
