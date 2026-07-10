import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { fetchAdminOrders } from '@/lib/orders-fetch';
import { parseStatusFilter, toOrderRows, pageCount, buildOrdersHref } from '@/lib/orders';
import { OrdersFilter } from '@/components/orders-filter';
import { OrdersTable } from '@/components/orders-table';

// Match the endpoint default (openapi: pageSize default 20, max 50). One page size is plenty for an
// admin list; we don't expose a page-size picker (YAGNI).
const PAGE_SIZE = 20;

/**
 * Admin orders list (Đơn hàng, P3-c). An async server component: it reads the status/page from the
 * URL (reading searchParams makes the route dynamic), fetches the live page from core-api forwarding
 * the session cookie, maps it with the pure adapters, and renders. Filter + pagination are URL-param
 * driven (shareable, no client fetch); only the checkbox multi-select is a client island.
 * Loading is ./loading.tsx (skeleton); a fetch failure is caught by (app)/error.tsx (retry); an
 * empty page renders the table's empty-state branch (spec §03).
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const status = parseStatusFilter(sp.status);
  // Floor + clamp: a hand-typed ?page=2.5 / 0 / -1 / junk resolves to a valid 1-based integer rather
  // than reaching the endpoint as a non-integer (400). Huge pages are clamped server-side (P3-b).
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const t = await getTranslations('orders');

  const list = await fetchAdminOrders({ status, page, pageSize: PAGE_SIZE });
  const rows = toOrderRows(list);
  const pages = pageCount(list.total, list.pageSize);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-text-strong">{t('title')}</h1>
        <OrdersFilter value={status} />
      </header>

      <OrdersTable rows={rows} />

      {pages > 1 && (
        <nav aria-label={t('pagination')} className="flex items-center justify-between gap-4 pt-1">
          <PagerLink
            disabled={list.page <= 1}
            href={buildOrdersHref({ status, page: list.page - 1 })}
          >
            {t('prev')}
          </PagerLink>
          <span className="text-sm text-text-muted">{t('pageOf', { page: list.page, pages })}</span>
          <PagerLink
            disabled={list.page >= pages}
            href={buildOrdersHref({ status, page: list.page + 1 })}
          >
            {t('next')}
          </PagerLink>
        </nav>
      )}
    </div>
  );
}

/** Prev/next control: a real Link when navigable, an inert span at the ends (no dead link to click). */
function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const base =
    'inline-flex min-h-[44px] items-center rounded-lg border-2 px-4 py-2 text-sm font-semibold';
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${base} cursor-not-allowed border-border-subtle text-text-muted opacity-50`}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${base} border-border-strong text-text-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2`}
    >
      {children}
    </Link>
  );
}
