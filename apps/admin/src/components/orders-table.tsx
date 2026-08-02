'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnd, formatVnDate, type OrderStatus } from '@lumin/core';
import { Card } from '@lumin/ui';
import type { AdminOrderRow } from '@/lib/orders';
import { availableTransitions, type AvailableTransition } from '@/lib/order-detail';
import { transitionOrder } from '@/lib/order-actions';
import { OrderStatusBadge } from './order-status-badge';
import { ROLE } from './order-detail-view';
import { TransitionDialog } from './transition-dialog';

/**
 * Orders list body (P3-c). One component owns both responsive layouts and the multi-select state:
 * a desktop table (from `md`) and a mobile card stack (below `md`, matching Admin Mobile Hi-fi),
 * fed by the same rows + selection Set. Client component because selection is interactive.
 *
 * Each row/card's code links to the order-detail route (/don-hang/{id}, P3-e) where the per-order
 * transition flow lives. Multi-select is still a SCAFFOLD: rows are checkable and the selection bar
 * reports the count, but the BULK action stays inert (a bulk transition is N× POST /transitions —
 * deferred) — see the comment on the bar.
 */
/**
 * Change-status-inline (per row) — the orders list previously had NO way to move an order except
 * opening its detail page (P3-e). Reuses the SAME transition machinery the detail page uses
 * (availableTransitions/transitionOrder/TransitionDialog) so this is not a second, drifting
 * implementation of the state machine's RBAC/edge rules — just a shorter path to it. A native
 * `<select>` (rung 4 of the ladder: platform feature over a custom dropdown/menu component) lists
 * only the edges `canTransition` allows from THIS row's status for ROLE; `confirm`/`advance` fire
 * immediately, `ship`/`cancel`/`refund` still need their extra fields so they open the same dialog.
 */
function RowActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const t = useTranslations('orders');
  const tDetail = useTranslations('orderDetail');
  const router = useRouter();
  const [dialog, setDialog] = useState<AvailableTransition | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = availableTransitions(status, ROLE);

  if (actions.length === 0) {
    return <span className="text-xs text-text-muted">{t('actionDone')}</span>;
  }

  async function onPick(to: string) {
    const action = actions.find((a) => a.to === to);
    if (!action) return;
    if (action.kind === 'confirm' || action.kind === 'advance') {
      setError(null);
      setPending(true);
      const res = await transitionOrder(orderId, { to: action.to });
      setPending(false);
      if (res.ok) router.refresh();
      else setError(res.code);
    } else {
      setDialog(action);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        aria-label={t('bulkStatus')}
        disabled={pending}
        value=""
        onChange={(e) => void onPick(e.target.value)}
        className="min-h-[36px] rounded-lg border-2 border-border-subtle bg-surface-card px-2 text-sm font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky"
      >
        <option value="" disabled>
          {t('actionPlaceholder')}
        </option>
        {actions.map((a) => (
          <option key={a.to} value={a.to}>
            {tDetail(`action.${a.to}`)}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {tDetail(`error.${error}`)}
        </p>
      )}
      {dialog && (
        <TransitionDialog
          key={dialog.to}
          orderId={orderId}
          action={dialog}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

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
                <th scope="col" className="px-4 py-3">
                  {t('colAction')}
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
                  <td className="px-4 py-3 font-mono font-semibold">
                    <Link
                      href={`/don-hang/${r.id}`}
                      className="text-text-strong hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
                    >
                      {r.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-body">{r.customer}</td>
                  <td className="px-4 py-3 text-text-body">{r.productLabel}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-primary">
                    {formatVnd(r.total)}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{tChannel(r.channel)}</td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-text-muted">
                    {formatVnDate(r.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <RowActions orderId={r.id} status={r.status} />
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
                <Link
                  href={`/don-hang/${r.id}`}
                  className="font-mono font-semibold text-text-strong hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
                >
                  {r.code}
                </Link>
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
                <span className="shrink-0 font-mono font-bold text-primary">
                  {formatVnd(r.total)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs text-text-muted">{formatVnDate(r.createdAt)}</p>
                <RowActions orderId={r.id} status={r.status} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
