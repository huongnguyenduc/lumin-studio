import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { Card } from '@lumin/ui';
import type { RecentOrderRow } from '@/lib/dashboard';
import { OrderStatusBadge } from './order-status-badge';
import { ArrowRightIcon } from './icons';

/**
 * "Đơn hàng gần đây" table (design: Lumin Admin Hi-fi). Columns Mã / Khách / Tổng / Trạng thái.
 * Order code is mono, total via formatVnd, status via the shared OrderStatusBadge. Renders an
 * empty-state branch (message + CTA) when there are no orders (conventions §State). Data comes from
 * GET /admin/dashboard via the page (PR-3j); server component.
 */
export function RecentOrders({ orders }: { orders: RecentOrderRow[] }) {
  const t = useTranslations('dashboard');

  return (
    <Card elevation="md" className="overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <h2 className="text-lg">{t('recentOrders')}</h2>
        <Link
          href="/don-hang"
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary transition-colors hover:text-primary-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          {t('viewAll')}
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-4 px-5 py-12 text-center">
          <p className="text-text-muted">{t('ordersEmpty')}</p>
          <Link
            href="/don-hang"
            className="inline-flex min-h-[44px] items-center rounded-pill border-2 border-border-strong bg-primary px-5 py-2.5 font-display font-bold text-on-primary transition-colors hover:bg-primary-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          >
            {t('ordersEmptyCta')}
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-t border-border-subtle text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th scope="col" className="px-5 py-3">
                  {t('colCode')}
                </th>
                <th scope="col" className="px-5 py-3">
                  {t('colCustomer')}
                </th>
                <th scope="col" className="px-5 py-3 text-right">
                  {t('colTotal')}
                </th>
                <th scope="col" className="px-5 py-3">
                  {t('colStatus')}
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-border-subtle">
                  <td className="px-5 py-3 font-mono font-semibold text-text-strong">
                    {order.code}
                  </td>
                  <td className="px-5 py-3 text-text-body">{order.customer}</td>
                  <td className="px-5 py-3 text-right font-mono text-text-strong">
                    {formatVnd(order.total)}
                  </td>
                  <td className="px-5 py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
