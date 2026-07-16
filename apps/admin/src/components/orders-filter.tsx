import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@lumin/ui';
import { ORDER_STATUSES, type OrderStatus } from '@lumin/core';
import { buildOrdersHref } from '@/lib/orders';

/**
 * Status filter for the orders list (P3-c), on the hi-fi 2 chip row (replaces the old native
 * <select>): one pill per trạng thái + "Tất cả", the active one filled. Each chip is a real <Link>
 * (crawlable, keyboard/AT-native, works before hydration) that navigates to /don-hang?status=… and
 * drops the page param, so a new filter always starts on page 1; the server component re-fetches.
 * Per-status COUNTS on the chips (hi-fi "Tất cả (128)") need a per-status aggregate the list
 * endpoint doesn't return — deliberately omitted rather than fanning out 8 requests (noted in PR).
 * Active chip = flame-700 (`bg-primary`) — the hi-fi's flame-500 fill fails the AA contrast lock
 * (frontend rule: trắng-trên-flame-500 2.82:1), same a11y correction the sidebar already applies.
 */
export async function OrdersFilter({ value }: { value: OrderStatus | undefined }) {
  const t = await getTranslations('orders');
  const tStatus = await getTranslations('status');

  const chips: Array<{ status: OrderStatus | undefined; label: string }> = [
    { status: undefined, label: t('filterAll') },
    ...ORDER_STATUSES.map((s) => ({ status: s as OrderStatus, label: tStatus(s) })),
  ];

  return (
    <nav aria-label={t('filterLabel')}>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const active = chip.status === value;
          return (
            <li key={chip.status ?? 'all'}>
              <Link
                href={buildOrdersHref({ status: chip.status })}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-[40px] items-center rounded-pill border-2 px-4 text-sm font-semibold',
                  'transition-colors duration-150 ease-out motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
                  active
                    ? 'border-transparent bg-primary text-on-primary'
                    : 'border-border-strong bg-surface-card text-text-strong hover:bg-surface-sunken',
                )}
              >
                {chip.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
