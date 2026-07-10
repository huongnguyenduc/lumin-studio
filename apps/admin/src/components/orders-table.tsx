'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatVnd, formatVnDate } from '@lumin/core';
import { Card } from '@lumin/ui';
import type { AdminOrderRow } from '@/lib/orders';
import { OrderStatusBadge } from './order-status-badge';

/**
 * Orders list body (P3-c). One component owns both responsive layouts and the multi-select state:
 * a desktop table (from `md`) and a mobile card stack (below `md`, matching Admin Mobile Hi-fi),
 * fed by the same rows + selection Set. Client component because selection is interactive.
 *
 * Multi-select is a SCAFFOLD: rows are checkable and the selection bar reports the count, but the
 * bulk action is inert until P3-e (the order-detail transition flow) can wire it — see the comment
 * on the bar. Rows/cards are display-only here too; the per-order transition affordances the design
 * shows (inline status dropdown, "Chuyển … →") land in P3-e with the /don-hang/{id} detail route.
 */
export function OrdersTable({ rows }: { rows: AdminOrderRow[] }) {
  const t = useTranslations('orders');
  const tChannel = useTranslations('channel');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  if (rows.length === 0) {
    return (
      <Card elevation="md" className="px-5 py-16 text-center">
        <p className="text-text-muted">{t('empty')}</p>
      </Card>
    );
  }

  const allSelected = rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const clear = () => setSelected(new Set());

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div
          role="region"
          aria-label={t('selectionLabel')}
          className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-border-strong bg-surface-sunken px-4 py-3"
        >
          <span className="font-semibold text-text-strong">
            {t('selectedCount', { count: selected.size })}
          </span>
          {/* ponytail: bulk "Đổi trạng thái" is an inert seam — a bulk transition is N× POST
              /orders/{id}/transitions, which P3-e builds. Disabled (not hidden) so the scaffold
              matches the design and P3-e has an obvious spot to wire the modal (plan §202). */}
          <button
            type="button"
            disabled
            className="inline-flex min-h-[44px] cursor-not-allowed items-center rounded-pill border-2 border-border-subtle px-4 py-2 font-semibold text-text-muted opacity-60"
          >
            {t('bulkStatus')}
          </button>
          <button
            type="button"
            onClick={clear}
            className="inline-flex min-h-[44px] items-center rounded-pill px-3 py-2 font-semibold text-text-body hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          >
            {t('clearSelection')}
          </button>
        </div>
      )}

      {/* Desktop: table (md+) */}
      <Card elevation="md" className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t('selectAll')}
                    className="h-4 w-4 align-middle"
                  />
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('colCode')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('colCustomer')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('colProduct')}
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  {t('colTotal')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('colChannel')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('colStatus')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('colDate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-subtle last:border-b-0">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={t('selectOne', { code: r.code })}
                      className="h-4 w-4 align-middle"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-text-strong">{r.code}</td>
                  <td className="px-4 py-3 text-text-body">{r.customer}</td>
                  <td className="px-4 py-3 text-text-body">{r.productLabel}</td>
                  <td className="px-4 py-3 text-right font-mono text-text-strong">
                    {formatVnd(r.total)}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{tChannel(r.channel)}</td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-text-muted">
                    {formatVnDate(r.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile: card stack (below md) */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Card elevation="md" className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono font-semibold text-text-strong">{r.code}</span>
                <OrderStatusBadge status={r.status} />
              </div>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  aria-label={t('selectOne', { code: r.code })}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text-strong">{r.customer}</p>
                  <p className="truncate text-sm text-text-muted">
                    {r.productLabel} · {tChannel(r.channel)}
                  </p>
                </div>
                <span className="shrink-0 font-mono font-semibold text-text-strong">
                  {formatVnd(r.total)}
                </span>
              </div>
              <p className="text-right font-mono text-xs text-text-muted">
                {formatVnDate(r.createdAt)}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
