'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatVnDate } from '@lumin/core';
import { cn } from '@lumin/ui';
import { buildTimeline, type TimelineData } from '@/lib/order-lookup-view';
import { CtaLink } from './cta-link';
import { ChevronDownIcon } from './icons';
import { OrderStatusBadge, OrderTimeline } from './order-timeline';

/**
 * The signed-in customer's order history (/tai-khoan, P1-s). GET /customer/orders returns the SAME
 * public timeline projection as the guest lookup (no money/PII — ADR-032), so each row reuses the P1-o
 * OrderStatusBadge/OrderTimeline verbatim. Every list item already carries its full milestones, so a row
 * expands to its timeline inline — no per-order detail fetch, and no polling (history is a one-shot read).
 */
export function OrderHistoryList({ orders }: { orders: TimelineData[] }) {
  const t = useTranslations('account');

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <h3 className="font-display text-base font-bold text-text-strong">{t('emptyTitle')}</h3>
        <p className="max-w-sm text-sm text-text-muted">{t('emptyBody')}</p>
        <CtaLink href="/danh-muc" className="mt-2">
          {t('emptyCta')}
        </CtaLink>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {orders.map((order) => (
        <li key={order.code}>
          <OrderHistoryRow order={order} />
        </li>
      ))}
    </ul>
  );
}

function OrderHistoryRow({ order }: { order: TimelineData }) {
  const t = useTranslations('account');
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border-2 border-border-default bg-surface-card">
      {/* Disclosure: the visible code + date is the button's accessible name; aria-expanded conveys the
          open/closed state, so no separate "xem chi tiết" label is needed (avoids a label-in-name clash). */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-sky"
      >
        <span className="flex flex-col gap-1">
          <span className="font-mono text-sm font-bold text-text-strong">{order.code}</span>
          <span className="text-xs text-text-muted">
            {t('orderedOn', { date: formatVnDate(order.createdAt) })}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              'h-5 w-5 text-text-muted transition-transform duration-150 motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>

      {open ? (
        <div className="border-t-2 border-border-subtle p-4">
          <OrderTimeline model={buildTimeline(order)} />
        </div>
      ) : null}
    </div>
  );
}
