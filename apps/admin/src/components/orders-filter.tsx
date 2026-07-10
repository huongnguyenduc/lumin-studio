'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ORDER_STATUSES, type OrderStatus } from '@lumin/core';
import { buildOrdersHref } from '@/lib/orders';

/**
 * Status filter for the orders list (P3-c). A native `<select>` — not a custom dropdown — so it is
 * keyboard/AT-native for free (a11y rule; the same choice P2-d made for the province field).
 * Changing it navigates to /don-hang?status=… and drops the page param, so a new filter always
 * starts on page 1; the server component re-fetches. "" = Tất cả (no filter).
 */
export function OrdersFilter({ value }: { value: OrderStatus | undefined }) {
  const router = useRouter();
  const t = useTranslations('orders');
  const tStatus = useTranslations('status');

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-text-muted">{t('filterLabel')}</span>
      <select
        value={value ?? ''}
        onChange={(e) =>
          router.push(
            buildOrdersHref({ status: (e.target.value || undefined) as OrderStatus | undefined }),
          )
        }
        className="min-h-[44px] rounded-lg border-2 border-border-strong bg-surface-card px-3 py-2 font-semibold text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
      >
        <option value="">{t('filterAll')}</option>
        {ORDER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {tStatus(s)}
          </option>
        ))}
      </select>
    </label>
  );
}
