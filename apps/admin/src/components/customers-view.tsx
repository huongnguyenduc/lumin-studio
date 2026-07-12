'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatVnd, formatVnDate } from '@lumin/core';
import { Card, Input } from '@lumin/ui';
import { filterCustomers, type AdminCustomer } from '@/lib/customers';

/**
 * Customers list (P3-p, Khách hàng). The RSC fetches the whole roster once (unpaginated — a made-to-order
 * shop's base is small) and hands it here; search is client-side, no re-fetch (mirrors the products grid).
 * The name/phone match lives in `filterCustomers` (accent-folded name OR digit-only phone). Money (Tổng
 * chi) is rendered by @lumin/core formatVnd — never a raw literal (always-must #2). Each row's "Xem" links
 * to the detail route (/khach-hang/{id}). Empty states are split (conventions §State): a truly empty roster
 * gets the "no customers yet" note, a search miss a reset.
 */
export function CustomersView({ customers }: { customers: AdminCustomer[] }) {
  const t = useTranslations('customers');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => filterCustomers(customers, query), [customers, query]);

  // Nothing at all → the full empty state; there is nothing to search, so no search box.
  if (customers.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header count={0} />
        <div className="rounded-xl border-2 border-dashed border-border-strong bg-surface-card px-6 py-16 text-center text-text-muted">
          {t('empty')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Header count={customers.length} />

      <Input
        type="search"
        label={t('searchLabel')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('searchPlaceholder')}
        autoComplete="off"
      />

      {filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border-strong bg-surface-card px-6 py-12 text-center">
          <p className="text-text-muted">{t('noMatch', { query: query.trim() })}</p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="mt-3 min-h-[44px] text-sm font-semibold text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky"
          >
            {t('reset')}
          </button>
        </div>
      ) : (
        <Card elevation="md" className="overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-text-muted">
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('colName')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('colContact')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('colOrders')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('colSpent')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('colRecent')}
                </th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <CustomerRow key={c.id} customer={c} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Header({ count }: { count: number }) {
  const t = useTranslations('customers');
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h1 className="font-display text-2xl font-semibold text-text-strong">{t('title')}</h1>
        <span className="font-mono text-sm text-text-muted">{t('count', { count })}</span>
      </div>
      <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
    </div>
  );
}

function CustomerRow({ customer }: { customer: AdminCustomer }) {
  const t = useTranslations('customers');
  return (
    <tr className="border-b border-border-subtle last:border-0">
      <td className="px-4 py-3 font-display font-semibold text-text-strong">{customer.name}</td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-text-body">{customer.phone}</span>
          {customer.socialHandle && (
            <span className="truncate font-mono text-xs text-accent-sky">
              {customer.socialHandle}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right font-mono text-text-body">
        {t('orderCount', { count: customer.orderCount })}
      </td>
      <td className="px-4 py-3 text-right font-mono text-text-strong">
        {formatVnd(customer.totalSpent)}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-text-muted">
        {customer.lastOrderAt ? formatVnDate(customer.lastOrderAt) : t('noOrdersYet')}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/khach-hang/${customer.id}`}
          className="inline-flex min-h-[36px] items-center rounded-lg border border-border-strong px-3 font-semibold text-text-body hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky"
        >
          {t('view')}
        </Link>
      </td>
    </tr>
  );
}
